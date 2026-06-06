const BLOCKED_APPROVALS = new Set(['unapproved', 'placeholder', 'unconfigured', 'mock-fixture', 'error']);

export const APPROVED_LIVE_SOURCE_REGISTRY = Object.freeze({
  // Intentionally empty for the MVP. Future live adapters must be added here
  // after their free/public status, license, and endpoint contract are reviewed.
});

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

export function evaluateLiveSourceApproval({ source = 'unknown', capabilities = {} } = {}) {
  const requestedApproval = capabilities.sourceApproval ?? 'unapproved';
  if (capabilities.mock === true) {
    return {
      approved: false,
      approval: 'mock-fixture',
      reason: 'Mock fixtures are never approved for live-monitor readiness.',
    };
  }

  const requestedLive = capabilities.liveMarketData === true
    && capabilities.approvedPublic === true
    && capabilities.readinessAllowed === true;
  if (!requestedLive) {
    return {
      approved: false,
      approval: requestedApproval,
      reason: 'Adapter did not declare every live-readiness capability flag.',
    };
  }

  if (!isNonEmptyString(requestedApproval) || BLOCKED_APPROVALS.has(requestedApproval)) {
    return {
      approved: false,
      approval: requestedApproval,
      reason: 'Adapter did not provide a usable source approval identifier.',
    };
  }

  const registryEntry = APPROVED_LIVE_SOURCE_REGISTRY[source];
  if (!registryEntry) {
    return {
      approved: false,
      approval: 'unapproved',
      requestedApproval,
      reason: 'Source is not present in the system-owned live-source approval registry.',
    };
  }

  const approvalMatches = registryEntry.sourceApproval === requestedApproval;
  const licenseMatches = registryEntry.license === capabilities.license;
  return {
    approved: approvalMatches && licenseMatches,
    approval: approvalMatches && licenseMatches ? requestedApproval : 'unapproved',
    requestedApproval,
    reason: approvalMatches && licenseMatches
      ? 'Source approval and license match the system-owned registry.'
      : 'Adapter approval or license does not match the system-owned registry.',
  };
}
