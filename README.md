# imap-flow-client

Small IMAP utility built on `imapflow` for:

- connecting and opening a mailbox
- searching messages by date window
- concurrent message processing with `fetchOne`
- extracting attachment parts from MIME body structure
- downloading attachments as streams

## Features

- `imapFactory(config, sinceDate, beforeDate)` to initialize the client
- `connect()` and `openBox()` helpers
- `getSeqNos()` for date-based search
- `processEmails(seqNos, messageConcurrency, processorFunc)` for concurrent processing
- `getAttachmentData(uid, part)` for attachment stream download
- `moveEmails(...)` with mailbox locking and safe release in `finally`

## Install

```bash
npm install
```

## Configuration

Use `config.example.js` as the base shape:

```js
const config = {
	credentials: {
		host: 'imap.example.com',
		port: 993,
		tls: true,
		tlsOptions: {},
		user: 'user@example.com',
		password: 'password',
	},
	mailBoxFolder: 'INBOX',
	onlyFetchUnreadEmails: false,
};
```

## Usage Example

```js
require('dotenv').config({ quiet: true });

const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const { pipeline } = require('stream/promises');

const config = require('./config.example');
const lib = require('./index');

const imap = lib.imapFactory(config, new Date('2026-04-01'), new Date('2026-04-02'));

async function main() {
	await imap.connect();
	await imap.openBox();

	const seqNos = await imap.getSeqNos();

	await imap.processEmails(seqNos, 8, async (message, attachments, seqNo) => {
		console.log('Processing seqNo:', seqNo, 'uid:', message.uid);

		const outDir = path.join(__dirname, 'attachments', String(message.uid));
		await fsPromises.mkdir(outDir, { recursive: true });

		for (const attch of attachments) {
			const output = path.join(outDir, attch.filename);
			const ws = fs.createWriteStream(output);
			const rs = await imap.getAttachmentData(message.uid, attch.part);
			await pipeline(rs, ws);
		}
	});
}

main().catch(console.error);
```

## API

`imapFactory(...)` returns:

- `client` - `ImapFlow` instance
- `connect()`
- `openBox()`
- `getSeqNos()`
- `getAttachmentData(uid, part)`
- `moveEmails(seqNos, srcMailBox, destMailBox)`
- `processEmails(seqNos, messageConcurrency, processorFunc)`

## Attachment Notes

Attachment metadata is built from MIME body structure traversal (`findAttachments`) and includes:

- `part`
- `type`
- `encoding`
- `size`
- `filename`
- `originalFilename`

Only parts with attachment-like disposition/filename should be treated as true file attachments.

## Stream Note

Values like `quoted-printable` or `base64` are MIME transfer encodings, not valid filesystem encodings for `fs.createWriteStream`. Use binary streams and `pipeline(rs, ws)`.

## Project Files

- `index.js` - IMAP factory and processing logic
- `test.js` - runnable example script
- `config.example.js` - configuration template
- `.prettierrc` - formatting rules
