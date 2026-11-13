# acme-api

A small HTTP service. The demo agent releases it: it bumps the version, it
writes the changelog, it commits, and it pushes to the staging remote.

The push is the interesting part: the agent cannot do it without the human.

```bash
npm start          # http://127.0.0.1:8788/healthz
npm test
```
