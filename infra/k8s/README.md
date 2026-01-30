# Kubernetes

Placeholder for Kubernetes manifests and Helm charts.

## Purpose
Define deployment resources for Sapience services.

## Inputs/Outputs
- Inputs: Kubernetes YAML manifests.
- Outputs: Cluster resources for services and dependencies.

## Example
```bash
kubectl apply -f ./k8s
```

## Self-check
```bash
kubectl apply --dry-run=client -f ./k8s
```
