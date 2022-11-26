
nostr-libnotify
===============

Listen for events to a pubkey and send desktop notifications via notify-send

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

Basic usage:

    $ nostr-notify <hex-pubkey>

For encrypted dm support:

    $ git config --global --set nostr.secretkey <hex-secret-key>
    $ nostr-notify

OR

    $ export NOSTR_SECRET_KEY=<hex secret key>
    $ nostr-notify
