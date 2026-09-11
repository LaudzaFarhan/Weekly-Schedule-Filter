import {
  GET as getNewCrm,
  POST as postNewCrm,
  PUT as putNewCrm,
  PATCH as patchNewCrm,
  DELETE as deleteNewCrm,
} from '../new/crm/route';

export async function GET(request) {
  return getNewCrm(request);
}

export async function POST(request) {
  return postNewCrm(request);
}

export async function PUT(request) {
  return putNewCrm(request);
}

export async function PATCH(request) {
  return patchNewCrm(request);
}

export async function DELETE(request) {
  return deleteNewCrm(request);
}

