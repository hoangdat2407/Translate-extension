# Google OAuth setup checklist

## Need these values

- Extension ID after `Load unpacked`.
- Redirect URI from extension Options:

```text
https://<extension-id>.chromiumapp.org/oauth2
```

- Google OAuth Client ID:

```text
xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
```

## Google Cloud steps

1. Create/select Google Cloud project.
2. Enable Google Drive API.
3. OAuth consent screen:
   - User type: External is fine for personal testing.
   - Add your Gmail as test user if app is in Testing mode.
4. Credentials -> Create Credentials -> OAuth Client ID.
5. Application type: Web application.
6. Authorized redirect URIs: paste the Redirect URI from extension Options.
7. Save -> copy Client ID.
8. Extension Options -> paste Client ID -> Save.
9. Popup -> Login & Sync Google.

## Common errors

### redirect_uri_mismatch

Cause: Google Cloud does not have the exact redirect URI.

Fix: Copy Redirect URI from Options again and paste it exactly into Google Cloud.

### Missing Google OAuth Client ID

Cause: You have not pasted Client ID in Options.

Fix: Paste Client ID and save.

### Access blocked / app not verified

Cause: OAuth consent screen is in testing mode or scopes changed.

Fix: Add your Gmail as a test user in OAuth consent screen.

### Google Drive API failed 403

Cause: Drive API not enabled, wrong project, or consent/scope issue.

Fix: Enable Google Drive API in the same project where the OAuth Client ID exists.
