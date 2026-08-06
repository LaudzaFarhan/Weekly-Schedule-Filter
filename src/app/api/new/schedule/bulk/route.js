import { query, withTransaction } from '@/lib/db';
import { NextResponse } from 'next/server';

/**
 * POST /api/new/schedule/bulk
 * Bulk insert internal class schedule rows in a single transaction.
 * Payload: { classes: [ { day, time, program, student, teacher, branchName, classType, remarks }, ... ] }
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const { classes } = body;

    if (!Array.isArray(classes) || classes.length === 0) {
      return NextResponse.json({ error: 'No class schedule records provided' }, { status: 400 });
    }

    const validClasses = classes
      .filter((c) => c && typeof c === 'object' && c.day && c.time && c.student)
      .map((c) => ({
        ...c,
        teacher: c.teacher ? String(c.teacher).trim() : 'TBD',
        branchName: c.branchName ? String(c.branchName).trim() : 'Bekasi',
      }));

    if (validClasses.length === 0) {
      return NextResponse.json({ error: 'No valid class records with required fields found' }, { status: 400 });
    }

    const insertedRows = await withTransaction(async (client) => {
      const results = [];
      const CHUNK_SIZE = 50;

      for (let i = 0; i < validClasses.length; i += CHUNK_SIZE) {
        const chunk = validClasses.slice(i, i + CHUNK_SIZE);
        const valueClauses = [];
        const params = [];
        let paramIndex = 1;

        chunk.forEach((c) => {
          const day = String(c.day).trim();
          const time = String(c.time).trim();
          const program = c.program ? String(c.program).trim() : 'General';
          const student = String(c.student).trim();
          const teacher = String(c.teacher).trim();
          const branchName = String(c.branchName).trim();
          const classType = c.classType ? String(c.classType).trim() : 'Regular';
          const remarks = c.remarks ? String(c.remarks).trim() : null;

          valueClauses.push(
            `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7})`
          );
          params.push(day, time, program, student, teacher, branchName, classType, remarks);
          paramIndex += 8;
        });

        const sql = `
          INSERT INTO internal_classes (day, time, program, student, teacher, branch_name, class_type, remarks)
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
      classes: insertedRows,
    });
  } catch (error) {
    console.error('Error in bulk schedule insert API:', error);
    return NextResponse.json({ error: error.message || 'Failed to bulk import schedule classes' }, { status: 500 });
  }
}
