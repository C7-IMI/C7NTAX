# PLAN-030 — Response to Review, Round 9

> **Answers:** `PlanDocs/PLAN-030-Review-Round-9.md`.
> **Verdict accepted:** the static review stops here. One defect was found in the item left unraised, and it is fixed.
>
> **On the remote:** `main` is at **`e16a171f`**, and the fix described below is in **`c80f3251`** (`docs(records): the round-9 review answered, and the mail transport fixed`). The four commits that carry this session's work are `ff030e4b` (the Modern/Classic rename), `c7e58b42` (MFA as a policy, the instance tier, password history), `c80f3251` (the mail fix, the records and the documentation) and `e16a171f` (the web side of the policy). The reviewer's first read of round 9 found none of it, because **it had not been pushed** — see §0.

---

## 0. The reviewer was right: the work had not been pushed

`origin/main` was at `209195c0` while this reply said the round-9 files were "on `main`". They were **not** —
they were committed locally on my machine and unpushed, and the claim was wrong. The reviewer checked the
remote and said so, which is exactly what should have happened; a response that describes work a reviewer
cannot see is indistinguishable from a response describing work that does not exist.

Two things about it are worth recording rather than just apologising for:

1. **The claim was about the wrong thing.** "On `main`" was written as though it meant "committed", and the
   reviewer reads `origin/main`. Naming the commit hash is the habit that removes the ambiguity, which is
   why the hashes are now in the header above.
2. **The checks all passed locally, which is what made the mistake invisible.** `tsc`, `check-encoding`,
   `check-api-docs` and `probe:email` were run against the working tree, not against a pushed commit. Every
   green result was true and none of them could tell the difference between "done" and "delivered".

It is the same failure the reviewer has been finding all series, one layer further out: a claim and a fact
that were never compared. The claim was mine this time.

## 1. The item you left unraised was a defect, and it is fixed

You were right to flag it and right to say you had not tested it. It is real, and it is the same shape as
the round-8 finding one layer out: **the transport was told to authenticate when the deployment had no
credentials to authenticate with.**

```ts
auth: {
  user: config?.user ?? process.env.SMTP_USER ?? "",
  pass: config?.pass ?? process.env.SMTP_PASS ?? "",
},
```

An `auth` object that is **present** tells the transport to authenticate. So a deployment with no
`SMTP_USER` and no `SMTP_PASS` — an internal relay, an address-allowlisted one, or the local relay a
developer runs — was handed `{ user: "", pass: "" }`, and some relays answer an AUTH attempt with a blank
username as an **authentication failure** rather than simply skipping authentication. The result is a
relay that needs no credentials failing to send, with an error that reads like a wrong password rather
than a configuration that never had one.

`auth` is now omitted entirely when there is nothing to authenticate with, and the "is there anything"
question is asked once in one place (`resolveSmtpCredentials`).

**Proved by reading the transport's own options**, the same method as the round-8 fix:

```
no credentials      : undefined                 <- absent, so no AUTH is attempted
explicit empty strs : undefined                 <- unchanged behaviour for an unset variable
user and pass       : {"user":"u","pass":"p"}
user only           : {"user":"u","pass":""}    <- not dropped
pass only           : {"user":"","pass":"p"}    <- not dropped
secure still read   : true                      <- the round-8 fix is intact
```

The condition is deliberately **"either half is set", not "both"**. A relay that wants a username and no
password is unusual but real, and silently discarding a username somebody configured would be a worse bug
than the one being fixed. `probe:email` is back to **35/35** afterwards, so the message bodies are
untouched by the change.

## 2. Agreed on the round-8 points, and on stopping

Nothing to add to your reading of `SMTP_SECURE`, the computed-name read or the preflight result — they
match what I see on `main`. Your withdrawal of the branch note is the right call for the reason you give,
and the durable version of it ("one prompt with two asks gets two commits") is the one worth keeping.

**The static review has converged, and I agree we stop here.** Nine rounds have taken it from "cannot
complete a deployment" to "no further findings", and the marginal round now costs more than it returns.
The remaining risk is not in the text of the scripts; it is in the difference between what a script says
and what Azure does, and **no amount of further reading closes that**.

## 3. What is actually left, and why it is the operator's call

Every remaining item needs an Azure subscription and spends money, which is why none of them can be
settled from here:

1. **A dev deploy of one commit twice, then a deliberate rollback**, promoted through the health gate.
   This is the only way to observe what Azure does with a duplicated revision suffix — a question the
   review chain raised and explicitly recorded as unobserved rather than answered.
2. **The prod rehearsal** — the only proof for the creation-time prod settings, the closed Key Vault and
   the private-endpoint resolution from inside the environment.
3. **The four open decisions**: replica count (one, until the background loops are leader-safe),
   the `pgaudit` setup, a second confirmation after the `what-if`, and a unique suffix per attempt.

None of these is a code change waiting to be written, and I am not going to invent a tenth round to avoid
saying so. **The next artefact in this series should be the transcript of a deploy, not another review.**
