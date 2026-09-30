# Getting started

## Join an existing server

Ask your workspace administrator for the server's web URL and an invitation if registration is restricted. Open it in a browser, or enter that URL in the desktop or mobile client's connect screen. Choose a sign-in method offered by the server. Follow the [user guide](user-guide.md) for everyday use.

You do not need Docker or developer tools to join someone else's server.

## Install a local server

Install Git and Docker with Compose v2.24 or newer. Start Docker first. On Windows use PowerShell 7 and Docker Desktop in Linux-container mode.

On macOS, Linux, or WSL:

```sh
git clone https://github.com/chark1es/Aulora.git
cd Aulora
./install.sh
```

On Windows:

```powershell
git clone https://github.com/chark1es/Aulora.git
Set-Location Aulora
pwsh ./install.ps1
```

The installer asks for an owner email and password of at least 16 characters. It creates `infra/docker/.env`, builds the stack, and provisions the workspace. The first build can take several minutes.

Open the printed URL, normally `http://localhost:8080`, and sign in with the owner account. The installer creates that account, so you do not need to register it again.

## Check the installation

From the repository root:

```sh
cd infra/docker
docker compose ps
docker compose logs --tail=100 setup
curl --fail http://localhost:8080/.well-known/aulora.json
```

On PowerShell use `curl.exe` for the last command. Setup should finish successfully and discovery should return JSON with the workspace name and a reachable Convex URL. Create a channel, send a message, upload a small file, and invite a second test account.

Keep `infra/docker/.env` private and back it up securely. It contains the encryption key needed to recover your messages. Database backups alone are insufficient.

## Make it available to your team

`localhost` only works on the machine hosting the server. A phone or another computer needs a reachable hostname and matching public URLs. For a public deployment, configure DNS, HTTPS, origin settings, private administration ports, and non-default database/storage credentials. Follow [self-hosting](self-hosting.md) or [Coolify](coolify.md) before inviting users.

Voice/video requires microphone/camera permissions and a secure origin. Some networks also need TURN. Mobile push requires a configured relay; it is optional.

## Next steps

- Configure [workspace access, roles, and invitations](admin.md).
- Set up [off-machine backups and test a restore](backups.md).
- Read [privacy](privacy.md) and [licensing](licensing.md).
- If something fails, use [troubleshooting](troubleshooting.md).
- To modify the code, follow [development setup](https://github.com/chark1es/Aulora/blob/main/docs/development.md).
