# Multi-OS Private vNet Simulation

Synthetic MIT proof for repeated virtual-computer neighborhoods.

- Windows, macOS, Linux, AS/400-style, and generic nodes share a declared
  private vNet.
- Both plans run the same 100 frozen replica results.
- Deterministic mode must fail on 94/100 agreement.
- Stochastic mode predeclares an exact 94/100 quorum and accepts the stable
  result while retaining all six outliers.

After summoning and saving the dimensions locally, replay with:

```bash
rapp-zoo-v2 simulate deterministic-plan.json fixture.json
rapp-zoo-v2 simulate stochastic-plan.json fixture.json
```

No hypervisor, proprietary image, credential, network fallback, shell command,
or arbitrary provider code is included.
