import { GET as getNewSchedule, POST as postNewSchedule } from '../new/schedule/route';

export async function GET(request) {
  return getNewSchedule(request);
}

export async function POST(request) {
  return postNewSchedule(request);
}
