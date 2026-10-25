# Design board

Comments pinned to screenshots of a design round, and handed back to the
agent that made it.

## Open it

```
ssh -L 4848:localhost:4848 predator
```

Then open http://localhost:4848. The board listens on predator's loopback
only. An agent that publishes a round starts it. To start it yourself, run
`npm run -s design-feedback -- serve --detach` from `frontend/` on predator.

## Reviewing a round

- **Sheet**: every screenshot of the round, variants side by side, with the
  agent's notes and questions at the top. Click a screenshot to open it.
- **On a screenshot**: drag a box, or click an element (the outline shows
  what a click takes; "wider" in the note moves to the element around it).
  Alt-click drops a point. Type the note and press Enter.
  - **Fix**: change this.
  - **Keep**: the next round must not lose it.
  - **Ask**: a question for the agent.
  - **Rule**: do it like this everywhere. The agent proposes it for
    `.interface-design/system.md` as a task.

  Ctrl+1 to Ctrl+4 switch between them while typing.

- **Variants**: side by side, or one at a time with 1 to 9. **Pick** marks
  the one you want.
- **Send back**: another round. The agent works through your notes and
  publishes the next round. Notes you have not resolved show there as dashed
  marks, with the agent's reply and "Is it?" when it says one is done.
- **OK as corrected**: no new round. The agent does what is still marked, then
  goes on to tests and commits.

The top bar says whether an agent is waiting on the round. If none is, the
send bar gives you the command to paste into its session.

Keys: ← → for the previous and next screenshot, z to zoom, v for side by side,
p to pick, n for a note on the whole screenshot, Esc to go back, ? for the
list.

## For agents

See `frontend/.claude/skills/design-feedback/SKILL.md`, and
`npm run -s design-feedback` for the commands.
