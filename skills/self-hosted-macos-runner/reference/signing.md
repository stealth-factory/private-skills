# Signing on a self-hosted Mac

A hosted runner throws its keychain away with the VM. A self-hosted Mac keeps
everything, so each job builds its own keychain and removes it, even when the
job fails.

## Certificate (.p12) signing

```yaml
- name: Temporary keychain
  env:
    P12_BASE64: ${{ secrets.DIST_CERT_P12_BASE64 }}
    P12_PASSWORD: ${{ secrets.DIST_CERT_P12_PASSWORD }}
  run: |
    KEYCHAIN="$RUNNER_TEMP/ci-$GITHUB_RUN_ID.keychain-db"
    KEYCHAIN_PASSWORD=$(uuidgen)
    echo "CI_KEYCHAIN=$KEYCHAIN" >> "$GITHUB_ENV"
    # Remember the user's search list so cleanup can put it back.
    security list-keychains -d user | tr -d '"' | xargs > "$RUNNER_TEMP/keychains.before"
    security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
    security set-keychain-settings -lut 21600 "$KEYCHAIN"
    security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
    echo "$P12_BASE64" | base64 --decode > "$RUNNER_TEMP/cert.p12"
    security import "$RUNNER_TEMP/cert.p12" -P "$P12_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN"
    rm -f "$RUNNER_TEMP/cert.p12"
    security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" > /dev/null
    security list-keychains -d user -s "$KEYCHAIN" $(cat "$RUNNER_TEMP/keychains.before")

# … archive and export, passing OTHER_CODE_SIGN_FLAGS="--keychain $CI_KEYCHAIN" if needed …

- name: Remove keychain
  if: always()
  run: |
    if [ -f "$RUNNER_TEMP/keychains.before" ]; then
      security list-keychains -d user -s $(cat "$RUNNER_TEMP/keychains.before")
    fi
    [ -n "${CI_KEYCHAIN:-}" ] && security delete-keychain "$CI_KEYCHAIN" || true
```

Two concurrent signing jobs each prepend their own keychain to the same user's
search list. Keep TestFlight uploads in one `concurrency:` group so only one
signing job runs at a time.

## App Store Connect API key (automatic signing)

```yaml
- name: API key
  env:
    ASC_KEY_P8: ${{ secrets.ASC_KEY_P8 }}
  run: |
    printf '%s' "$ASC_KEY_P8" > "$RUNNER_TEMP/AuthKey.p8"
    chmod 600 "$RUNNER_TEMP/AuthKey.p8"

# xcodebuild archive … -allowProvisioningUpdates \
#   -authenticationKeyPath "$RUNNER_TEMP/AuthKey.p8" \
#   -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID"

- name: Remove API key
  if: always()
  run: rm -f "$RUNNER_TEMP/AuthKey.p8"
```

Automatic signing can create and download certificates and profiles into the
runner user's keychain and `~/Library/Developer/Xcode/UserData/Provisioning Profiles`.
On a Mac that also serves as someone's workstation, run the runner as its own
macOS user so those stay out of the person's account.
