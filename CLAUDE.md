# Quality Assurance Rules

1. Prefer communication
   Whenever you're unsure about a big design decision, you can ask for clarification.

1. Clean changes
   Before modifying files at the beginning of your run, initialize a new change using jj:
   `jj new -m 'Description of the change'`

   You are free to pick a short description based on the prompt from the user.
   Do not use the feat: style: format. Just a normal description of the feature.

1. Be location dependent

   - If you're modifying frontend code, follow frontend/CLAUDE.md and the skills in frontend/.claude/skills
   - If you're modifying pipeline code, follow data/pipelines/CLAUDE.md and the skills in data/pipelines/.claude/skills
   - Claude Code loads both on its own once you work on a file in that directory.

1. **Failure Protocol**:

   - If the checks fail, do NOT ask for review. Analyze the error, fix the code, and re-run the tests.
   - Only request review once tests pass.

1. Allow modifications
   You can modify those rules, especially if I ask you to do something and it seems like a good thing to keep in mind.
