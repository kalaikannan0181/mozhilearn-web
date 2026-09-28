# Architecture

MozhiLearn is a web-only preparation system today.

```text
Vite + React :8443
      |
      v
Express REST API :5000
      |
      +--> PostgreSQL 18
      +--> server-side AI translation provider
```

Authentication uses PostgreSQL users, bcrypt password hashes, and HttpOnly session cookies. Private API routes inspect the session server-side and enforce reviewer/admin roles where required.

AI translation is a draft-producing service only. It writes `source = ai` and `status = ai_generated`; human workflow is required before approval.

Offline packs are server-side published bundles. The sync endpoints prepare content for a future Android client. Android, Room, Retrofit, APK packaging, and offline AI are intentionally not part of this repository yet.
