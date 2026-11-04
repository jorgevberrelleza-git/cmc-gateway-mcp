# Shadow read-only Groq research canary (experimental)
This is a deliberately isolated prototype, **NOT production trading AI**.
- Provider: Groq API with openai/gpt-oss-20b; free-tier availability/quotas depend on account and may change.
- No dependency, paid deployment, Bitso secret or trading permission.
- Disabled by default. Module is not imported by the current cron, `reasoning-provider`, or order engine.
- Accepts only allowlisted symbols, timestamps and <=8 short facts. Returns **untrusted** research notes, never executable signals.
- HTTP endpoint is fixed to HTTPS. Timeout 10 seconds. HTTP failures fail closed.
- Test without network: `node scripts/learning-groq-canary-selftest.mjs`.
- To test with live provider, create a Groq API key in the provider console and place it **only** in a private environment variable `GROQ_API_KEY` in a separate, disposable test environment. Do not commit keys or send them in chat. This pull request does not create or modify credentials.
- Do **not** activate any live network test until free-tier limits, data privacy and monthly cap are explicitly verified. Never send customer identifiers, secrets, portfolio balances, or nonpublic data.
- The output is not a trusted evidence source. Changes to production reasoning require a separate PR: JSON validation, source provenance, rate limiter, daily budget, CI, shadow-only canary logs, no order permission, and 72h monitoring.
- Rollback: do not merge PR; deleting this isolated module/test has no effect on Render.
