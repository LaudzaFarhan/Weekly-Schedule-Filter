import {
  GET as getNewInstructors,
  POST as postNewInstructors,
  PUT as putNewInstructors,
  DELETE as deleteNewInstructors,
} from '../new/instructors/route';

export async function GET(request) {
  return getNewInstructors(request);
}

export async function POST(request) {
  return postNewInstructors(request);
}

export async function PUT(request) {
  return putNewInstructors(request);
}

export async function DELETE(request) {
  return deleteNewInstructors(request);
}
