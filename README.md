# Zero-Sum

A self-hosted game night wrapper that adds another layer of fun to a multi-game board/card game night.

Everyone joins from their own phone (no app install). Games earn **gold**. Every player is listed as a stock that the others can trade. Quarterly polls, covert memos and an NFT minting side-hustle round it out, and the night ends with a market collapse and a podium. One person runs it as the GM from a laptop or phone. A TV shows the live broadcast.

- **Players:** 10–20 phones in a browser
- **GM:** one Master GM, plus optional assistant GMs
- **TV:** any browser on the big screen
- **Network:** LAN only. No internet needed while you play.

---

## Install

You need Docker with the Compose plugin on any machine on your network (a Linux box, an LXC or VM on Proxmox, a NAS…).

```sh
git clone https://github.com/mscottwhit12-hub/Zero-Sum.git zero-sum
cd zero-sum
docker compose up -d --build
```

The first build needs internet (it downloads packages) and takes a few minutes. After that the app runs fully offline.

Open `http://<server-ip>:8080` from any device on the same network.

### First run

1. Open `http://<server-ip>:8080/gm` and create the **Master GM**: name, password (8+ characters) and an unlock PIN. There are no default passwords.
2. On the GM Dashboard, create tonight's night, then **Open joins**.
3. Players open `http://<server-ip>:8080` on their phones and tap **Join the firm**.
4. Open `http://<server-ip>:8080/display` on the TV and click **Enable audio** once.
5. When everyone is in, press **Start night**.

| Page | Who |
| --- | --- |
| `/` | Landing page: join, rejoin, TV, GM |
| `/play` | Player phone |
| `/display` | TV |
| `/gm` | GM console (Master or assistant GM) |

---

## Your data

Two folders next to `docker-compose.yml` are mounted into the container:

| Folder | Holds |
| --- | --- |
| `./data` | The database, player avatars and generated statements. **Back this folder up.** |
| `./media` | Your own media. Sounds uploaded from the GM Soundboard are stored in `./media/sounds`. |

Games, rulebook entries and sounds are global: they carry over from night to night. Use **Library → Export pack** to share your game list as a JSON file.

To back up, stop the container (or just copy while it's idle) and copy `./data`.

## Update

```sh
cd zero-sum
git pull
docker compose up -d --build
```

Database changes are applied automatically on start. Your data stays in `./data`.

## Settings

Every gameplay number (stake, payouts, market behaviour, vote timing, re-rolls, …) is a GM setting under **GM → Settings**, and can be changed live.

Server options (set in `docker-compose.yml` or a `.env` file next to it):

| Variable | Default | Meaning |
| --- | --- | --- |
| `ZS_PORT` | `8080` | Port on the host |
| `TZ` | `UTC` | Time zone shown in timestamps (e.g. `America/Chicago`) |

## Troubleshooting

- **Phones can't connect:** they must be on the same network as the server, using its LAN IP (not `localhost`). Check that the host firewall allows port 8080.
- **No sound on the TV:** browsers block audio until someone interacts with the page. Click **Enable audio** on `/display`.
- **Permission errors in `./data` or `./media`:** the container makes both folders writable for its internal user (uid 1000) on start. If your host locks that down, `chown -R 1000:1000 data media`.
- **Locked out of the GM laptop:** a paused GM device unlocks with **Resume device** from your phone, or with your PIN.
- **Logs:** `docker compose logs -f`.

---

## Development

Needs Node.js 22.

```sh
npm ci
npm run build          # build the client
npm start              # server on :8080 (data and media under packages/server/)
npm test               # engine, server and simulation tests
npm run typecheck
```

For live client reloading, run `npm start` in one terminal and `npm run dev -w @gn/client` in another, then open `http://localhost:5173`.

Layout:

```
copy/en.json        all user-facing text (cheap to reskin)
assets/             sample game library, house rules, name blocklist
packages/engine     pure game rules (scoring, market, votes, …), no I/O
packages/sim        headless night simulator used to tune the defaults
packages/server     Fastify + Socket.IO + SQLite
packages/client     Svelte: landing, phone, GM console, TV
```

Run the simulator: `npm run sim -w @gn/sim`.

## License

MIT. See [LICENSE](LICENSE).
