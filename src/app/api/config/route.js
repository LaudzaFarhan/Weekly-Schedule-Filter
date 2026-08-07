// Updated: 2026-08-07
import {
  GET as getNewConfig,
  PUT as putNewConfig,
  DELETE as deleteNewConfig,
} from '../new/config/route';

export async function GET(request) {
  return getNewConfig(request);
}

export async function POST(request) {
  return putNewConfig(request);
}

export async function PUT(request) {
  return putNewConfig(request);
}

export async function DELETE(request) {
  return deleteNewConfig(request);
}
