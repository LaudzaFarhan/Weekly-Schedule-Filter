import {
  GET as getNewConfig,
  POST as postNewConfig,
} from '../new/config/route';

export async function GET(request) {
  return getNewConfig(request);
}

export async function POST(request) {
  return postNewConfig(request);

