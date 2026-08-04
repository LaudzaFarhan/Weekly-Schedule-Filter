# Deployment

**Production is the VPS at `thelabindonesia.my.id` (`187.77.127.199`), and only the VPS.**

nginx in front, Next.js behind it, PostgreSQL on the same box. Pushing to GitHub
does not deploy anything — deploying means running a script on the server.

> **History worth knowing.** This project has had three deployment paths at once:
> Vercel, a GitHub Pages workflow, and the VPS. Only the VPS was real. The Pages
> workflow uploaded `./dist`, which `next build` has never produced, so it failed
> on every push. Vercel served a second live copy of the app with write access to
> the production database. Both are retired; if you find a reference to either,
> it is stale.

---

## 1. Deploy

On the server:

```bash
cd /path/to/app
./scripts/deploy.sh
```

That fetches `main`, installs from the lockfile, runs the tests, builds, and
restarts. It refuses to build if a build-time variable is missing — see below for
why that check exists.

Flags for when you need them:

| Flag | Effect |
|---|---|
| `SKIP_TESTS=1` | Build without running tests. Mid-incident only. |
| `SKIP_FIREBASE=1` | Build without the Firebase variables. Old Operations sign-in stops working; New Operations accounts still do. |

Rollback, if a deploy goes wrong:

```bash
rm -rf .next && mv .next.previous .next
pm2 restart thelab   # or: sudo systemctl restart thelab
```

---

## 2. Build-time vs run-time variables

This is the one thing about this deployment that has actually bitten.

`NEXT_PUBLIC_*` values are **inlined into the browser bundle when the build runs**.
They are not read from the environment at startup. A value added after the build,
followed by a restart, changes nothing — the old value, or `undefined`, is already
compiled into the JavaScript users download.

A build missing `NEXT_PUBLIC_FIREBASE_API_KEY` fails at the login screen with:

```
Firebase: Error (auth/api-key-not-valid.-please-pass-a-valid-api-key.)
```

which reads as a *wrong* key and sends you looking at Firebase rather than at your
own build. `scripts/deploy.sh` checks for these before building for that reason.

Everything else — `DATABASE_URL`, `EMPLOYEE_CREDENTIAL_KEY`, `NEW_OPS_API_KEY`,
`GOOGLE_SERVICE_ACCOUNT` — is read by the server at run time, so a restart suffices.

`.env.example` marks which is which. Copy it to `.env.local` on the server:

```bash
cp .env.example .env.local
```

`.env.local` is gitignored. `.env` is **tracked**, so nothing secret goes in it.

---

## 3. First-time server setup

Assuming Node 20+ and the repo cloned.

```bash
sudo apt install -y nginx
./setup_vps.sh                 # PostgreSQL, database, tables
cp .env.example .env.local     # then fill it in
npm ci && npm run build
```

Run it under a process manager so it survives a reboot:

```bash
npm install -g pm2
pm2 start npm --name thelab -- start
pm2 startup && pm2 save
```

The name **must** be `thelab` — that is what `scripts/deploy.sh` restarts.

nginx in front of it:

```nginx
server {
    server_name thelabindonesia.my.id;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

`X-Forwarded-Proto` matters: it is how the app knows whether the request arrived
over HTTPS, which decides whether the session cookie gets the `Secure` flag.

---

## 4. HTTPS

**Currently missing, and it is now the only thing between a password and the
network.** Port 443 does not answer; the site serves on port 80. Every login sends
its password in cleartext, and the session cookie travels the same way.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d thelabindonesia.my.id
```

certbot edits the nginx config and sets up renewal. Redeploy afterwards so the
app sees `X-Forwarded-Proto: https` and starts marking the session cookie
`Secure`.

---

## 5. Lock down PostgreSQL

`setup_vps.sh` opens PostgreSQL to `0.0.0.0/0` and port 5432 to the internet,
because Vercel had to reach it from outside. **Nothing external needs it now.**
The app is on the same machine, so it should connect over localhost and the port
should be closed.

In `.env.local`:

```
DATABASE_URL=postgres://lab_operator:...@localhost:5432/thelabops
```

Then:

```bash
sudo ufw delete allow 5432/tcp
# /etc/postgresql/*/main/pg_hba.conf — remove the 0.0.0.0/0 line
sudo systemctl restart postgresql
```

Verify from your laptop that it is actually shut:

```bash
psql "postgres://lab_operator:...@187.77.127.199:5432/thelabops" -c 'select 1'
# should time out or refuse
```

Note this breaks the local helper scripts in `scratch/`, which connect to the
public IP. Run them over SSH on the server instead.

---

## 6. First Admin account

New Operations accounts live in PostgreSQL and are separate from the Firebase
accounts Old Operations uses. Being an Admin in one does not make you one in the
other.

The accounts API needs an Admin to create accounts, and there is no Admin on a
fresh database. Two ways through:

```bash
# On the server, using the app's own encryption so the login route can read it
node scratch/create_admin.mjs admin <password>
```

or, while `internal_users` is still empty, the API opens itself once and forces
the first account to be an Admin:

```bash
curl -X POST http://localhost:3000/api/new/users \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","email":"admin@thelab.id"}'
```

Then give every instructor a login from the **Users** page, or:

```bash
curl "http://localhost:3000/api/new/users/provision" -H "Authorization: Bearer $NEW_OPS_API_KEY"   # preview
curl -X POST "http://localhost:3000/api/new/users/provision" -H "Authorization: Bearer $NEW_OPS_API_KEY"
```

Usernames come from the instructor's name (`Felix Wijaya` → `felix.wijaya`) and
everyone starts on `instructor12345`.

---

## 7. Backups

Nothing is backing this up. The database is now the only copy of students,
classes, evaluations and accounts, on a single box.

```bash
# /etc/cron.daily/thelab-backup
pg_dump -U lab_operator thelabops | gzip > /var/backups/thelab-$(date +%F).sql.gz
find /var/backups -name 'thelab-*.sql.gz' -mtime +30 -delete
```

Copy them off the machine. A backup on the same disk as the database is not a
backup.

`EMPLOYEE_CREDENTIAL_KEY` needs backing up separately, somewhere that is not this
server. Without it a database dump cannot decrypt a single password, which is the
point of it — and also means losing it costs you every account.

---

## 8. Local development

```bash
npm install
cp .env.example .env.local    # fill in
npm run dev
```

Before you push:

```bash
npm run test
npm run build
```

CI (`.github/workflows/ci.yml`) runs both on every push. It does **not** deploy —
it only tells you whether `main` is deployable before you SSH in.

---

## 9. Troubleshooting

| Symptom | Cause |
|---|---|
| `auth/api-key-not-valid` at login | Built without `NEXT_PUBLIC_FIREBASE_API_KEY`. Add it to `.env.local` and **rebuild** — a restart is not enough. |
| New Operations login returns 503 | `EMPLOYEE_CREDENTIAL_KEY` unset. Restart is enough; it is read at run time. |
| Users page shows "Sign in with a New Operations account" | You are signed in with an Old Operations account. Sign out, sign in with a New Operations username. |
| Every New Operations page errors | `DATABASE_URL` unset or unreachable. |
| `/api/new/*` answers without a key | `NEW_OPS_API_KEY` unset leaves the gate open. Set it. |
| Site serves an old version after deploy | The app was not restarted. Check `pm2 logs thelab` or `journalctl -u thelab -f`. |
| Deploy refuses to build | A build-time variable is missing. It is telling you which. |

---

## 10. Retiring Vercel

For the record, so nobody wonders later:

1. Vercel dashboard → project → Settings → **Delete Project**. Until it is
   deleted it holds a live `DATABASE_URL` for the production database and will
   redeploy on every push to `main`.
2. Rotate the database password afterwards, since it existed in a third-party
   system: change it in `setup_vps.sh`, run `ALTER ROLE lab_operator WITH PASSWORD`,
   update `.env.local`, redeploy.
3. `rm -rf .vercel` locally. It is gitignored, so this is only tidying.

The `scratch/` helpers and `setup_vps.sh` still mention Vercel in places. Harmless,
but out of date.
