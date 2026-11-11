<!-- known-good: specific, voiced, real judgment. Expected verdict: keep-original / minimal edits. -->
We shipped the migration on Friday and it broke in a way I didn't predict. The new auth path worked
fine in staging because staging never sees the 2 a.m. burst from the batch importer. Production did,
and the token cache fell over inside ten minutes.

Here's what I got wrong: I treated the importer as a client like any other. It isn't. It opens 400
connections in a second and holds them. We rolled back by 3 a.m., and the fix is boring — a separate
rate limit for service accounts. I should have asked who the loudest caller was before I touched the
shared path. Next time I will.
