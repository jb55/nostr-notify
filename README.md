
nostr-notify
============

Listen for nostr events and sends desktop notifications via notify-send

![](https://jb55.com/s/58bfcd8f9c00cf4a.png)

Install
-------

    $ npm -g install nostr-notify
    $ nostr-notify

Dependencies
------------

libnotify/notify-send


Usage
-----

Configure relays:

    $ git config --global --set nostr.relays "wss://relay1.com wss://relay2.com"

OR

    $ export NOSTR_RELAYS="wss://relay1.com wss://relay2.com"

Run:

    $ nostr-notify <hex-pubkey>

For encrypted dm support:

    $ git config --global --set nostr.secretkey <hex-secret-key>
    $ nostr-notify

OR

    $ export NOSTR_SECRET_KEY=<hex secret key>
    $ nostr-notify
