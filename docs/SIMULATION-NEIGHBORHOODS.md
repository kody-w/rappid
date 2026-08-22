# Simulation neighborhoods

A RAPP cage may model any useful system as a neighborhood of virtual computers:
Windows clients, macOS workstations, Linux servers, AS/400-style machines, or
provider-defined generic nodes joined by a private vNet.

The public plan contains only image/configuration hashes, topology, synthetic
workloads, seeds, resource budgets, and invariants. It never carries VM disks,
credentials, customer data, shell commands, host paths, or raw hypervisor
flags.

## Repeated accuracy

Every run predeclares its interpretation:

- **Deterministic:** all replicas must be byte-identical. One divergence is a
  defect; 94/100 is a failed run.
- **Stochastic:** the exact quorum is declared before execution. A 94/100
  quorum may report the stable result, but all six outliers remain in the
  append-only report.

Results are clustered by canonical result hash. Errors are result records, not
silently discarded samples. The report binds the plan, all 100 results,
clusters, stable output (when accepted), durations, and evidence hash.

The simulation provider is injected locally. Control and events cross the exact
RAPP chat door; the provider's vNet/data plane stays inside the cage.
