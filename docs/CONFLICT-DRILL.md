# Conflict drill

This file exists for one reason: to give the Hermes conflict resolver a real
target on a real branch, instead of trusting a self-test.

## Section under drill

Side A rewrote this paragraph. It records that the deterministic leg of the
resolver must keep every JSON key, and that a drill is only worth running on a
real rebase with the real toolchain validating the result.

## Expected outcome

- the JSON file keeps every key from both sides;
- this paragraph mentions both edits;
- the toolchain validation runs before anything is pushed.
