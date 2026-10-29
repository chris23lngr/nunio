---
status: accepted
---

# Approval requires confirming the exact Action

An Approval is created only when the student confirms the exact Action nunio shows back to them (Destination, arguments, Artifact version), typically with one click on a confirmation card bound to the Action's fingerprint. A Chat request on its own, such as "put them in a study block tomorrow at 10", is never an Approval, even when it names the Action. This supersedes the earlier glossary wording that let a Chat request count as its own Approval.

The execution gate can verify that an Action matches a stored fingerprint, but it cannot verify that the model interpreted the student's free text faithfully. Letting model-interpreted text grant authority would make a misreading, or a prompt injection hidden in a Source, indistinguishable from consent. The cost is one confirmation click per Chat-initiated Action. Standing authority still comes only from Grants within Responsibilities (ADR-0001).
