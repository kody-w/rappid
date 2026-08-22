# Virtual computer neighborhoods

RAPP Zoo v2 may host a simulator, VM, container, or licensed remote machine as
one explicitly attached neighborhood. The first reference provider is the
clean-room virtual AS/400-style prototype.

## One door, two control registers

Both control styles use the exact RAPP/1 `POST /chat` wire:

1. Natural language for intent.
2. A deterministic typed envelope for fine control:

```text
|||AS400))||| {"schema":"rapp-zoo-machine-command/2.0","op":"library.create","args":{"name":"DEVLIB"},"idempotency_key":"job-1","turn_budget":1}
```

The machine may drive the AI back with a bounded event:

```text
|||AS400-EVENT))||| {"schema":"rapp-zoo-machine-event/2.0","kind":"job.completed","event_id":"job-1:completed","chain_depth":1,"payload":{"job":"DAILYREPORT"}}
```

No sibling privileged route is added. Events require exact subscriptions,
idempotency, a maximum chain depth of eight, and a finite turn budget. They
cannot self-trigger an unbounded AI/machine loop.

## Provider boundary

The public template declares capabilities, not raw hypervisor flags. The cage
refuses shell/eval/exec, host paths, credentials, and provider command lines.
A user-provided provider adapter translates approved operations into its own
licensed local runtime.

Runtime disks, credentials, snapshots, and customer data remain private. Public
summons contain only synthetic configuration and schemas.

Moving a virtual-computer neighborhood to another device/cloud moves its
identity, prototype data, event policy, and factory handoff. The destination
materializer assigns new endpoints and lifecycle capabilities.
