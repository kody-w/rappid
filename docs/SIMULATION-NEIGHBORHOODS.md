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

Live providers use an explicit local `file:` module URL, named export, canonical
provider-data document, and the literal trust declaration
`fully-trusted-local-code`. They execute with the Zoo user's OS privileges and
are **not** a hostile-code sandbox. Stage them in a sterile directory and review
them like any executable before use; the child receives read permission only
for the Zoo runtime, while snapshotted provider bytes arrive over bounded stdin.

The separate process is a fault-containment boundary: small heap, bounded
stdin/stdout/stderr, fatal protocol decoding, process-tree kill on timeout, and
parent-side canonical revalidation. Function serialization and captured caller
state are not part of the provider contract. Zoo snapshots the bounded provider
bytes once; every replica imports that same in-memory source, never the mutable
original path. Every report binds the executed module hash, export, trust
declaration, and provider-data hash.

## Offline fixture replay

The headless CLI accepts only inert JSON, never an arbitrary provider module:

```bash
rapp-zoo-v2 simulate plan.json fixture.json
```

The plan is capped at 256 replicas and 256 KiB. Seeds are bounded strings. The
fixture is capped at 128 KiB and must contain exactly one result for every
declared replica. Canonical result records have a separate 512 KiB aggregate
budget, clusters retain hashes and replica membership without duplicating
payloads, and the final evidence report remains inside the 1 MiB RAPP canonical
budget. The same clustering and acceptance engine used by live injected
providers produces the report.

The public
[`multi-os-vnet-simulation`](../examples/multi-os-vnet-simulation/README.md)
example freezes 100 results: deterministic replay fails at 94/100, while the
predeclared stochastic 94/100 quorum passes and retains all six outliers.
