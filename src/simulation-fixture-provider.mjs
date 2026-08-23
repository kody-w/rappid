export async function executeReplica({ replica, provider_data: fixture }) {
  return fixture[replica];
}
