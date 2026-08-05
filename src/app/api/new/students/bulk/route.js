import { query, withTransaction } from '@/lib/db';
import { NextResponse } from 'next/server';

/**
 * POST /api/new/students/bulk
 * Bulk insert internal students in a single transaction.
 * Payload: { students: [ { name, level, branchName, parentName, contact, status, remarks }, ... ] }
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const { students } = body;

    if (!Array.isArray(students) || students.length === 0) {
      return NextResponse.json({ error: 'No student records provided' }, { status: 400 });
    }

    // Validate that required fields are present for each student
    const validStudents = students.filter(
      (s) => s && typeof s === 'object' && s.name && String(s.name).trim() !== ''
    );

    if (validStudents.length === 0) {
      return NextResponse.json({ error: 'No valid student records with names found' }, { status: 400 });
    }

    const insertedRows = await withTransaction(async (client) => {
      const results = [];
      // Batch inserts in chunks of 50 for safety and speed
      const CHUNK_SIZE = 50;
      for (let i = 0; i < validStudents.length; i += CHUNK_SIZE) {
        const chunk = validStudents.slice(i, i + CHUNK_SIZE);
        const valueClauses = [];
        const params = [];
        let paramIndex = 1;

        chunk.forEach((student) => {
          const name = String(student.name).trim();
          const level = student.level ? String(student.level).trim() : 'Kinder Core';
          const branchName = student.branchName ? String(student.branchName).trim() : 'Bekasi';
          const parentName = student.parentName ? String(student.parentName).trim() : null;
          const contact = student.contact ? String(student.contact).trim() : '';
          const status = student.status ? String(student.status).trim() : 'Active';
          const remarks = student.remarks ? String(student.remarks).trim() : null;

          valueClauses.push(
            `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6})`
          );
          params.push(name, level, branchName, parentName, contact, status, remarks);
          paramIndex += 7;
        });

        const sql = `
          INSERT INTO internal_students (name, level, branch_name, parent_name, contact, status, remarks)
          VALUES ${valueClauses.join(', ')}
          RETURNING *
        `;

        const res = await client.query(sql, params);
        results.push(...res.rows);
      }
      return results;
    });

    return NextResponse.json({
      success: true,
      count: insertedRows.length,
      students: insertedRows,
    });
  } catch (error) {
    console.error('Error in bulk student insert API:', error);
    return NextResponse.json({ error: error.message || 'Failed to bulk import students' }, { status: 500 });
  }
}
