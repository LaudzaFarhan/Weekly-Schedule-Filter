import Papa from 'papaparse';

/**
 * Parse CSV text from a Google Sheets tab into class records.
 */
export function parseCSVData(csvText, dayName) {
  const classes = [];
  const teachers = new Set();
  const baseTeachers = new Set();
  const times = new Set();

  Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    complete(results) {
      let lastTime = '';
      let lastTerm = '';
      let lastTeacher = '';
      let lastBaseTeacher = '';

      results.data.forEach((row) => {
        if (!row['Student Name'] && !row['Time'] && !row['Term-Branch']) return;
        if (row['Time'] === 'Time' || row['Term-Branch'] === 'Term-Branch') return;

        let time = row['Time'] ? row['Time'].trim() : lastTime;
        let term = row['Term-Branch'] ? row['Term-Branch'].trim() : lastTerm;

        const rawColumnC = row['Main Inst/PIC'] ? row['Main Inst/PIC'].trim() : '';
        let baseTeacher = rawColumnC || lastBaseTeacher;
        let teacher = baseTeacher;

        if (baseTeacher) lastBaseTeacher = baseTeacher;
        if (baseTeacher && baseTeacher !== '-') baseTeachers.add(baseTeacher);

        const lessonArrange = row['Lesson Arrange Date'];
        if (lessonArrange && lessonArrange.includes(',')) {
          const parts = lessonArrange.split(',');
          const assignedInstructor = parts[parts.length - 1].trim();
          if (assignedInstructor && assignedInstructor !== '-') {
            teacher = assignedInstructor;
          }
        } else if (!lessonArrange || lessonArrange.trim() === '') {
          if (!rawColumnC) {
            teacher = '';
          }
        }

        if (time.startsWith('010.')) time = time.substring(1);

        if (time) lastTime = time;
        if (term) lastTerm = term;
        if (teacher) lastTeacher = teacher;

        const student = row['Student Name'] ? row['Student Name'].trim() : '';

        if (student && teacher && time) {
          classes.push({
            day: dayName,
            time,
            program: term,
            teacher,
            student,
            remarks: row['Remarks'] || '',
            fullProgram: row['Program'] || '',
          });

          if (teacher !== '-') teachers.add(teacher);
          times.add(time);
        }
      });
    },
  });

  return { classes, teachers, baseTeachers, times };
}
