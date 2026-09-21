# Error Log

Raw evidence for DX journal entries. Secrets removed. Nothing here is synthesized;
if an error was not observed, it does not appear.

---

## DX-001 — empty 202 from the documentation host

**Observed:** 2026-09-21 18:47 UTC

```
$ curl -sS -m 30 -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...' \
    -H 'Accept: text/plain,text/markdown,*/*' \
    https://web3.binance.com/en/dev-docs/llms.txt -o llms.txt \
    -w "http=%{http_code} bytes=%{size_download}\n"
http=202 bytes=0
```

Reproduced with and without a browser User-Agent. A browser-equivalent fetch of the
same URL returned the full document.

Earlier in the same session the host failed DNS resolution entirely from the sandboxed
shell, then resolved on retry. The empty 202 persisted after DNS recovered, so the two
are separate problems.

---

## Live API errors

None. No authenticated call has been attempted; no credentials exist.

This section must only ever contain errors actually observed from the Binance Web3
API. Synthetic or anticipated errors belong in tests, never here.
