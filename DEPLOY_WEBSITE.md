# Website Deployment Notes

This app can be deployed cheaply as a single website instance.

Recommended first deployment:
- App host: Railway
- Database: Neon Postgres
- Email: Resend SMTP
- Redis: disabled
- Cloudinary backups: disabled

Files added for deployment:
- `railway.json` sets build, migrate, start, and `/health` checks
- `.env.example` lists the env vars to fill in

Important env vars for the first launch:
- `REDIS_ENABLED=false`
- `CHAT_BACKUPS_ENABLED=false`
- `CLOUDINARY_CLOUD_NAME=`
- `CLOUDINARY_API_KEY=`
- `CLOUDINARY_API_SECRET=`
- `APP_DATA_DIR=/data`

You still need:
- a Postgres database
- a real `JWT_SECRET`
- SMTP configured so OTP emails reach users

You do not need for the first launch:
- Redis
- Cloudinary
- desktop packaging

Beginner flow:
1. Push this repo to GitHub again after these deployment changes.
2. Create a Neon database and copy both connection strings from Neon `Connect`.
3. Set `DATABASE_URL` to the pooled URL with `-pooler` in the hostname.
4. Set `DIRECT_URL` to the direct non-pooler URL for Prisma migrations.
5. The database name in Neon may be `neondb` instead of `chat_app`. That is fine; use the full URLs Neon gives you.
6. Create a Resend account, verify a sending domain, and copy the SMTP/API credentials.
7. Create a Railway project from GitHub using this repository.
8. Add a volume mounted at `/data`.
9. Add the environment variables from `.env.example`.
10. Deploy and wait for `/health` to go green.
11. Open the Railway domain and test signup, OTP email, login, and sending a message.

Local verification before Railway:
- Set `DATABASE_URL` in `.env` to the pooled Neon connection string.
- Set `DIRECT_URL` in `.env` to the direct Neon connection string.
- Run `npm run prisma:generate`.
- Run `npm run prisma:migrate:deploy`.
- Run `npm run start:dev`.

Important Neon note:
- Some local networks block outbound Postgres connections on port `5432`.
- If local Prisma commands cannot reach Neon but Railway can, deploy anyway and let Railway run the migrations during `preDeploy`.

Important note about `release/`:
- Keeping old desktop build files in GitHub will not stop the website from deploying.
- It only makes the repository heavier.
- The new `.gitignore` entry prevents future desktop builds from being added automatically, but already tracked files remain tracked until you remove them in Git.
