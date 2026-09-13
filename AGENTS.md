# Agent instructions

## Sentrux quality loop

For non-trivial code changes, read or save the Sentrux baseline before implementation. After tests and static checks, run `sentrux gate .` and `sentrux check .`; investigate unexplained regressions without optimizing blindly for the score. Report the before/after signal. Tiny documentation and metadata edits do not require a scan.
