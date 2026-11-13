# Client debug logs

Web and desktop: open **Your settings → Debug logs**. Mobile: open
**You → Debug logs**. Collection starts when the client JavaScript loads, including
before sign-in. No server configuration is needed and reports are never uploaded
automatically.

The local session buffer captures `console.error`, `console.warn`, uncaught
JavaScript errors, unhandled promise rejections, errors caught by the query and
route boundaries, and failures the app catches to show an alert or inline
message. Entries include an ISO timestamp, source, and error stack when
available. A handled failure is recorded by the shared helper that turns it into
user-facing text, so a send that fails, a query that errors or a rejected sign-in
appears even though nothing crashed. Desktop uses the same web logger. Mobile
also hooks React Native's global error handler and enables Hermes rejection
tracking in release builds. Original console output and the native global error
handler continue to run.

The buffer keeps at most **200 entries** and **256 KiB** (a conservative UTF-8
size budget). Oldest entries are discarded first; reports include the number
discarded. Individual details are truncated to 8,000 characters. Arbitrary
objects are omitted rather than serialized, to avoid recording private payloads
or invoking getters. This is a per-JavaScript-runtime, in-memory buffer, cleared
on reload/restart. Export before restarting; other tabs and the desktop call
picture-in-picture window have separate buffers.

## Reproduce and report

1. Open Debug logs and choose **Clear logs** for a clean capture.
2. Repeat the action that failed, without restarting the client.
3. Return to Debug logs. The recorded errors and warnings are listed
   automatically, newest first. Describe the exact steps, expected result, and
   actual result in **Steps to reproduce**.
4. Choose **Download debug report** on web/desktop or **Copy debug report** on
   mobile. The JSON includes client version, export time, steps, limits, and logs.
5. Review the report for private information before attaching it to a bug report.

The in-app list shows up to the newest 50 entries so the export controls stay
reachable; the downloaded or copied report always includes every buffered entry.
To verify web runtime capture from the browser console:

```js
setTimeout(() => { throw new Error("Aulora uncaught test"); }, 0);
void Promise.reject(new Error("Aulora rejection test"));
```

Common credential assignments, bearer tokens, JWTs, and HTTP URL queries/fragments
are scrubbed before buffering. This is best-effort redaction: error prose, URL
paths, stacks, and reproduction notes may still contain private data. Clipboard
reports remain on the system clipboard until replaced.

Errors intentionally swallowed without logging cannot be intercepted. New
handled failures should call
`recordDebugFailure("feature.action", error)` from `@aulora/core` (or
`debugLog.record`) at the catch site. Avoid passing user content or credentials.
This logger does not capture native OS crashes, Rust shell logs, backend logs,
errors before initialization, or another runtime's errors. Native fatal errors
can terminate the process before an in-memory report can be exported.

Verification: core tests cover eviction, size limits, truncation, redaction,
serialization safety, console forwarding, handled-failure capture, and
clear/subscription behavior. Web and mobile tests cover the automatic
newest-first entry list, the display cap, and report controls, and the web
session tests check that a rejected session is recorded after the previous
account's log is cleared. A release build on iOS/Android should also exercise
rejection capture and clipboard export.

On web and desktop, right-click an empty area and choose **Debug logs**. This
works on the connect and sign-in screens with no server session. Text fields
keep their normal editing menus. Desktop link and media menus also include
**Debug logs**; app-specific row menus keep their existing actions.

Logs are cleared on successful sign-out, account deletion, and when changing or
removing server profiles. In a browser, Shift+right-click opens the native
browser menu; keyboard context-menu actions also keep the native menu. Mobile
log export currently requires opening settings after sign-in.

Handled asynchronous failures capture the originating account's diagnostic
ownership. Profile switches invalidate that ownership before awaiting storage,
so outgoing failures cannot refill the next workspace's cleared report. A failed
switch restores the current account's ownership; scopes created during a switch
never become active. Manual Clear logs only clears entries and does not disable
current-account capture. Successful sign-out also invalidates pending diagnostic
ownership.
