# Security notes

Never commit:

- `.env`;
- credentials;
- API keys;
- AWS access keys;
- uploaded photos;
- runtime JSON;
- `node_modules`;
- generated build output.

The local JSON adapter is intended for a single-user demo. It is not a secure multi-user production store.

Before production deployment, add:

- authentication and authorization;
- managed database storage;
- private evidence storage;
- malware scanning;
- audit logging;
- least-privilege IAM;
- secure download URLs;
- production secret management.

If a secret is committed accidentally, revoke or rotate it immediately. Deleting the file later is not sufficient.