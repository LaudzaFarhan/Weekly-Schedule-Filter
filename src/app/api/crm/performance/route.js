import { GET as getPerformance } from '../../new/crm/performance/route';

export async function GET(request) {
  return getPerformance(request);
}
