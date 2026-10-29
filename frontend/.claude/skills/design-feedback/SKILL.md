---
name: design-feedback
description: Show Szymon a round of UI screenshots on the design board, wait for the comments he pins to them, and work through them round after round. Use for every UI change that waits for his OK, and when he points you at notes he left on a round.
---

# The design board

Szymon reviews the look of a change by eye. On the board he draws a box (or
clicks an element) on a screenshot and says what is wrong with it, picks a
variant, answers your questions, then sends the round back or OKs it. You get
his comments as a digest, each with a crop of the screenshot around its box.
The board runs on predator's loopback only. He reaches it with
`ssh -L 4848:localhost:4848 predator` and opens http://localhost:4848.

**Every UI change that waits for his OK.** Szymon, 2026-10-29: "now always
run it on UI changes to be approved, not only on request" (on 2026-10-25 it
was "only on request for now"). Once a render has been through the
design-review skill, it goes on the board as a round, rather than as
screenshots in chat with a question. Read one he points you at too
(`read <round>`).

Commands run from `frontend/`, on the host, not under `devns`: inside a
namespace the board's port is the namespace's own loopback.

## A round

1. **Capture.** In your render script, take screenshots with `shoot` instead
   of `page.screenshot`. It writes `<name>.dom.json` beside each PNG, the DOM
   census. With it, a click on the board snaps to the element under the
   pointer, and the digest names the elements a box is on. Without it, a box
   is only coordinates and a crop.

   ```ts
   import { shoot } from "<workspace>/frontend/scripts/design-feedback/capture";
   await shoot(page, `${out}/tip/out-desktop/osoba.png`); // full page
   await shoot(page.locator(".person-head"), file); // one element
   ```

   Lay variants out as `<dir>/<variant>/<group>/<page>.png`, which is what
   the render kits in `~/.cache/koryta` already write. The path under the
   variant is the key. The board lines variants up by key and carries
   comments to the same key in the next round, so keep keys stable between
   rounds.

2. **Publish.** Before you show anything, run the design-review skill on the
   render, as before.

   ```
   npm run -s design-feedback -- publish <dir> --variants a,b --skip='-top$' \
     --round <topic>-r1 --title "<what this is>" \
     --notes "<what changed, what to look at>" \
     --question "Phone rows: A or C?|A|C"
   ```

   `--variants '*'` takes every subdirectory. Without `--variants`, every PNG
   is its own key. Give a regex that starts with a dash as `--skip=-x`. Use
   `--dpr 2` for 2x screenshots that have no census. A census records its
   own scale.

3. **Tell him, and wait.** Give him the link, and Read one or two key PNGs in
   chat as before. Then run `npm run -s design-feedback -- wait <round>` with
   `run_in_background`. It blocks until he presses send, prints the digest
   and exits, which wakes you up. If he says in chat that he has sent it, or
   your wait has died, `read <round>` gives the same digest.

4. **Work through the digest.** Read the crop of every comment before you
   change anything. The crop shows what he meant, and the text alone often
   does not.
   - **fix**: change it, then
     `reply <comment id> "<what you changed>" --addressed --in <next round>`.
     If you will not change it, reply with `--declined` and the reason.
   - **question** (shown as Ask): answer with `reply <id> "<answer>"`.
   - **keep**: the next round must not lose it.
   - **rule**: he wants it site-wide. Add a task proposing it for
     `.interface-design/system.md`, quoting him. Never write that file
     yourself.
   - **Picks** and **answers** are his decisions on your variants and
     questions.
   - **Sent back**: publish the next round with `--next <round>` (the id is
     numbered for you, and open comments carry over), then wait again.
   - **OK as corrected**: do what is still open without another round, then
     go on to tests, baselines and commits. The approved capture still
     becomes a committed visual spec.

## Good to know

- `list` shows every round. `read <round> --peek` shows the digest without
  marking it read. `status` says whether the board is up.
- `publish` and `wait` start the board if it is down. It runs detached, logs
  to `~/.cache/koryta/design-feedback/server.log`, and `stop` ends it.
- Everything lives in `~/.cache/koryta/design-feedback/rounds/<id>/`:
  `round.json`, the copied screenshots, and `events.jsonl`, the append-only log
  of every comment, reply, pick and send.
- A comment stays in the round it was made in. A later round shows it as a
  dashed mark ("from r2") until Szymon resolves it there.
