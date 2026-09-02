# Still meditation timer

Still is a static meditation timer for `https://veenspace.com/meditate/`. It has countdown and open-ended modes, four original bell and gong sounds, a tap-to-black screen, and a Screen Wake Lock.

A web page cannot write to Apple Health. The optional queue sends a completed session to a Cloudflare Worker. A Shortcut on your own iPhone or iPad then imports the session as Mindful Minutes. The timer iPad and the Health device can use different Apple Accounts.

## Deploy the Health queue

You need a Cloudflare account with Workers and D1 enabled. Do not put either secret in this repository.

1. Install the Worker dependencies and sign in to Cloudflare.

	```sh
	cd meditate/worker
	npm install
	npx wrangler login
	```

2. Create the D1 database.

	```sh
	npx wrangler d1 create meditation-queue
	```

3. Copy the returned database ID into `wrangler.jsonc`. Replace `REPLACE_WITH_D1_DATABASE_ID` and leave the binding name as `DB`.

4. Apply the database migration.

	```sh
	npx wrangler d1 migrations apply meditation-queue --remote
	```

5. Generate two different secrets. Each command prints a 64-character key. Save both keys in your password manager and label them `WRITE_TOKEN` and `IMPORT_TOKEN`.

	```sh
	openssl rand -hex 32
	openssl rand -hex 32
	```

6. Store the secrets in Cloudflare. Paste the matching key at each prompt.

	```sh
	npx wrangler secret put WRITE_TOKEN
	npx wrangler secret put IMPORT_TOKEN
	```

7. Deploy the Worker.

	```sh
	npx wrangler deploy
	```

8. Save the `https://...workers.dev` URL that Wrangler prints. Confirm that the Worker responds.

	```sh
	curl https://YOUR-WORKER.workers.dev/api/health
	```

The response is `{"ok":true,"service":"meditation-queue"}`.

## Set up the timer iPad

1. Open `https://veenspace.com/meditate/` in Safari on your wife's iPad.
2. Tap the settings icon.
3. Enter the Worker URL and the `WRITE_TOKEN` value.
4. Tap **Test connection**. The page confirms that the iPad has write-only access.
5. Tap **Save**.
6. Open Safari's Share menu and tap **Add to Home Screen**.
7. Open Still from its new Home Screen icon.

The Health switch applies to each session. If the queue is offline when a session ends, Still keeps the session in that iPad's local storage and retries later.

The Screen Wake Lock needs iPadOS 16.4 or later. iPadOS can still release the lock when the page loses visibility or the system needs to save power. Still requests it again when the page becomes visible.

## Build the Apple Health Shortcut

Build and run this Shortcut on your iPhone or iPad, under the Apple Account whose Health data should receive the sessions. Do not put this Shortcut or the `IMPORT_TOKEN` value on your wife's iPad.

1. Create a new Shortcut named `Import meditation sessions`.
2. Add a **Text** action with the Worker URL. Name its output `Queue URL`.
3. Add another **Text** action with the `IMPORT_TOKEN` value. Name its output `Import Key`.
4. Add a **URL** action whose value is `Queue URL/api/sessions`.
5. Add **Get Contents of URL** with these settings:

	- Method: `GET`
	- Header name: `Authorization`
	- Header value: `Bearer Import Key`

6. Add **Get Dictionary Value**. Get `sessions` from **Contents of URL**.
7. Add **Repeat with Each** and pass it the `sessions` value.
8. Inside the repeat block, add **Get Dictionary Value**. Get `startDate` from **Repeat Item**.
9. Add **Get Dates from Input** and pass it the `startDate` value. Rename the result `Start Date`.
10. Add **Get Dictionary Value**. Get `endDate` from **Repeat Item**.
11. Add **Get Dates from Input** and pass it the `endDate` value. Rename the result `End Date`.
12. Add **Log Health Sample** with these settings:

	- Type: `Mindful Minutes`
	- Start Date: `Start Date`
	- End Date: `End Date`

13. After **Log Health Sample**, add **Get Dictionary Value**. Get `id` from **Repeat Item** and rename the result `Session ID`.
14. Add a **URL** action whose value is `Queue URL/api/sessions/Session ID/imported`.
15. Add **Get Contents of URL** with these settings:

	- Method: `POST`
	- Header name: `Authorization`
	- Header value: `Bearer Import Key`
	- Request Body: `JSON`
	- JSON field: `imported`, set to Boolean `true`

16. Leave the second **Get Contents of URL** action after **Log Health Sample**. If the Health action fails, the Shortcut stops before it removes the queued session.
17. Run the Shortcut once. Allow Shortcuts to write Mindful Minutes when Health asks.

Apple has changed the **Log Health Sample** editor across iOS releases. If the editor does not accept the parsed dates, confirm that **Start Date** is earlier than **End Date** and that both variables have the Date type.

To import each day without opening Shortcuts, create a personal automation on your Health device:

1. Open **Shortcuts** and select **Automation**.
2. Create a **Time of Day** automation.
3. Set it to run daily and choose **Run Immediately**.
4. Add **Run Shortcut** and select `Import meditation sessions`.

## Understand the duplicate edge case

The Shortcut removes a queue record only after Health accepts it. If Health accepts a session but the final acknowledgment request loses its network connection, the queue keeps that session. The next import can add a duplicate Mindful Minutes entry. After an acknowledgment error, check Health before you run the Shortcut again.

The queue stores only the session ID, start time, end time, timer mode, and record creation time. The `WRITE_TOKEN` can add records but cannot list them. The `IMPORT_TOKEN` can list and remove records but cannot add them.

## Run the tests

From `meditate/`, run:

```sh
npm test
```

Regenerate the original WAV files with:

```sh
npm run generate:audio
```
