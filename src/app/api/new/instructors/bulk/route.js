import { query, withTransaction } from '@/lib/db';
import { NextResponse } from 'next/server';

/**
 * POST /api/new/instructors/bulk
 * Bulk insert internal instructors in a single transaction.
 * Payload: { instructors: [ { name, level, branches, contact, status, remarks }, ... ] }
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const { instructors } = body;

    if (!Array.isArray(instructors) || instructors.length === 0) {
      return NextResponse.json({ error: 'No instructor records provided' }, { status: 400 });
    }

    // Validate and clean instructors
    const validInstructors = instructors.filter(
      (inst) => inst && typeof inst === 'object' && inst.name && String(inst.name).trim() !== ''
    );

    if (validInstructors.length === 0) {
      return NextResponse.json({ error: 'No valid instructor records with names found' }, { status: 400 });
    }

    const insertedRows = await withTransaction(async (client) => {
      const results = [];
      const CHUNK_SIZE = 50;

      for (let i = 0; i < validInstructors.length; i += CHUNK_SIZE) {
        const chunk = validInstructors.slice(i, i + CHUNK_SIZE);
        const valueClauses = [];
        const params = [];
        let paramIndex = 1;

        chunk.forEach((inst) => {
          const name = String(inst.name).trim();
          const level = inst.level ? String(inst.level).trim() : 'Kinder and Junior';
          const branches = Array.isArray(inst.branches) ? inst.branches : ['Bekasi'];
          const contact = inst.contact ? String(inst.contact).trim() : 'N/A';
          const status = inst.status ? String(inst.status).trim() : 'Active';
          const remarks = inst.remarks ? String(inst.remarks).trim() : null;
          const aliases = Array.isArray(inst.aliases) ? inst.aliases : [];
          const verifiedAliases = Array.isArray(inst.verifiedAliases) ? inst.verifiedAliases : [];

          valueClauses.push(
            `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}::text[], $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}::text[], $${paramIndex + 7}::text[])`
          );
          params.push(name, level, branches, contact, status, remarks, aliases, verifiedAliases);
          paramIndex += 8;
        });

        const sql = `
          INSERT INTO internal_instructors (name, level, branches, contact, status, remarks, aliases, verified_aliases)
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
      instructors: insertedRows,
    });
  } catch (error) {
    console.error('Error in bulk instructor insert API:', error);
    return NextResponse.json({ error: error.message || 'Failed to bulk import instructors' }, { status: 500 });
  }
}
