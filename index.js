#!/usr/bin/env node

const {RelayPool, getPublicKey, decryptDm} = require('nostr')
const {spawn} = require('node:child_process')

const path = require('path')
const mkdirp = require('mkdirp')
const https = require('node:https')
const http = require('node:http')
const fs = require('node:fs').promises

const NOTIFY_TIMEOUT = process.env.NOTIFY_TIMEOUT || '10000'
const PFP_CACHE = path.join(process.env.HOME, ".local/share/nostr-libnotify/pfps")
const KINDS = {
	1: 'text',
	42: 'chat',
	3: 'follow',
	4: 'dm',
	6: 'share',
	7: 'reaction',
}

function notify({summary, body}, opts={}) {
	const args = [summary, body, '-t', NOTIFY_TIMEOUT]
	if (opts.picture) {
		args.push('-i')
		args.push(opts.picture)
	}
	spawn('notify-send', args)
}

async function get_relays() {
	const rs = process.env.NOSTR_RELAYS || (await dospawn("git", "config", "nostr.relays"))
	return rs.split(" ")
}

function dospawn(cmd, ...args)
{
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, [...args])
		proc.stdout.on('data', (data) => {
			resolve(data.toString("utf8").trim())
		})
		proc.on('close', code => {
			resolve(code)
		});
	})
}

async function get_privkey() {
	if (process.env.NOSTR_SECRET_KEY)
		return process.env.NOSTR_SECRET_KEY

	const sec = await dospawn("git", "config", "nostr.secretkey")
	if (!sec)
		return null
	return sec
}

async function get_pubkey(privkey) {
	if (privkey)
		return getPublicKey(privkey)

	if (process.argv[2])
		return process.argv[2]

	if (process.env.NOSTR_KEY)
		return process.env.NOSTR_KEY

	return 
}

function is_follow(ev) {
	return ev.kind === 3
}

function format_pubkey(pk) {
	return `${pk.slice(0,8)}:${pk.slice(56,64)}`
}

function format_kind(ev) {
	return KINDS[ev.kind] || `${ev.kind}`
}

function format_name(pk, profile)
{
	if (!profile)
		return format_pubkey(pk)

	if (profile.display_name && profile.name) {
		return `${profile.display_name} @${profile.name}`
	}

	if (profile.display_name)
		return profile.display_name

	if (profile.name)
		return `@${profile.name}`

	return format_pubkey(pk)
}

function format_dm_content(privkey, ev) {
	content = "*encrypted*"
	if (privkey) {
		try {
			content = decryptDm(privkey,ev) || "*encrypted*"
		} catch(e) {
			console.log("could not decrypt dm", e)
		}
	}
	return content
}

function format_msg(ev, profile, privkey) {
	const name = format_name(ev.pubkey, profile)
	const kind = format_kind(ev)

	if (ev.kind === 3)
		return {summary:"New Follower", body:`${name} followed you on nostr`}

	let content = ev.content

	if (ev.kind === 4 && privkey)
		content = format_dm_content(privkey, ev)

	return {summary: `nostr ${kind} from ${name}`, body: content}
}

function pfp_path(pubkey, picture)
{
	const url = new URL(picture)
	const filename = pubkey + path.extname(url.pathname)
	return path.join(PFP_CACHE, filename)
}

async function file_exists(file)
{
	try {
		await fs.stat(file)
		return true
	} catch(e) {
		if (e.code === 'ENOENT')
			return false
		throw e
	}
}

async function resolve_pfp(pubkey, picture)
{
	const file = pfp_path(pubkey, picture)
	const exists = await file_exists(file)
	if (exists)
		return file

	return (await download_picture(pubkey, picture))
}

function download_picture(pubkey, picture)
{
	return new Promise((resolve, reject) => {
		const mod = /^http:/.test(picture) ? http : https
		const file = pfp_path(pubkey, picture)
		const file_stream = new require('fs').createWriteStream(file);

		mod.request(picture, function(res) {
			res.pipe(file_stream)
			res.on('end', () => {
				resolve(file)
			})
			res.on('error', reject)
		})
		.end();
	});
}

async function resolve_profile(waiter, contacts, pool, pubkey) {
	const profiles = contacts.profiles
	const profile = profiles[pubkey]
	if (profile)
		return profile.profile

	const filter = {kinds: [0], authors: [pubkey], limit: 1}
	const subid = `profile-${pubkey}`

	pool.subscribe(subid, filter)

	const ev = await waiter(subid)

	pool.unsubscribe(subid)

	if (!ev) {
		console.log("timeout resolving profile", pubkey)
		return null
	}

	try {
		ev.profile = JSON.parse(ev.content)
	} catch {
		console.log("error parsing profile content", ev && ev.content)
	}

	if (ev.profile && ev.profile.picture) {
		const pfp_path = await resolve_pfp(pubkey, ev.profile.picture)
		if (pfp_path)
			contacts.pictures[pubkey] = pfp_path
	}

	return ev.profile
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
	const relays = await get_relays()
	const privkey = await get_privkey()
	const pubkey = await get_pubkey(privkey)
	await mkdirp(PFP_CACHE)

	if (!pubkey)
		return usage()

	const seen = new Set()
	const pool = RelayPool(relays)
	const profiles = {}
	const contacts = {profiles, pictures: {}}

	const waiter = make_waiter()

	pool.on('event', async (relay, subid, ev) => {
		if (seen.has(ev.id))
			return

		if (ev.kind === 3 && seen.has(ev.pubkey))
			return
		else
			seen.add(ev.pubkey)

		seen.add(ev.id)

		if (subid === "notifs") {
			const profile =
				await resolve_profile(
					waiter, contacts, pool, ev.pubkey)
			const msg = format_msg(ev, profile, privkey)
			notify(msg, {
				picture: contacts.pictures[ev.pubkey]
			})
		} else if (subid.startsWith("profile-")) {
			var profile = profiles[ev.pubkey]
			if (!profile || ev.created_at > profile.created_at)
				profile = profiles[ev.pubkey] = ev
			waiter(subid, profile)
		} else {
			console.log("unhandled subid", subid)
		}
	});

	const filter = {"#p": [pubkey], limit: 0}
	pool.subscribe("notifs", filter)
	console.log("listening to nostr events for", pubkey)
}

function make_waiter(opts={}) {
	const timeout = opts.timeout || 1000
	const subs = {}
	return (subid, ev) => {
		if (!ev) {
			const ours = new Promise((resolve) => {
				subs[subid] = resolve
			})
			return Promise.any([ours, sleep(timeout)])
		}

		if (!subs[subid]) {
			console.log("no waiter for", subid)
			return
		}

		subs[subid](ev)
		delete subs[subid]
	}
}

function usage() {
	console.log("usage: %s <your-pubkey>", process.argv[1])
	process.exit(1)
}


main()
