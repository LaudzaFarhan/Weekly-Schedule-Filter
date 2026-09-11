import { POST as postWebhook } from '../../new/crm/webhook/route';

export async function POST(request) {
  return postWebhook(request);
}
