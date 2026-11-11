# Conflict drill

This file exists for one reason: to give the Hermes conflict resolver a real
target on a real branch, instead of trusting a self-test.

## Section under drill

The base version of this paragraph. Two branches will rewrite it in two
different ways, and the resolver has to keep both intents rather than pick one.

## Expected outcome

- the JSON file keeps every key from both sides;
- this paragraph mentions both edits;
- the toolchain validation runs before anything is pushed.
