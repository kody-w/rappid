# Contributing

1. Keep the local developer core MIT, account-free, and offline-capable after
   import.
2. Do not copy source from RAPP Zoo v1 or commit customer/private data.
3. Run `npm run gate`.
4. Add a mutation whenever a new trust boundary is introduced.
5. Treat mutable GitHub branches as discovery only; execution/data inputs use a
   full commit and hash.
6. A prototype is not production. Keep factory handoffs `non_production: true`
   until a separate governed SDLC accepts them.
