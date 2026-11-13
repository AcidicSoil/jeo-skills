// Human-readable projection of Jeo's existing JSON results.
function asCell(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function table(headers, rows, limits) {
  const values = rows.map(row => row.map(asCell));
  const widths = headers.map((header, i) => Math.min(limits[i],
    Math.max(header.length, ...values.map(row => row[i].length))));
  const fit = (value, width) => value.length > width
    ? value.slice(0, width - 1) + '…'
    : value.padEnd(width);
  const row = cells => cells.map((value, i) => fit(value, widths[i])).join('  ');
  return [
    row(headers),
    widths.map(width => '─'.repeat(width)).join('  '),
    ...values.map(row),
  ].join('\n') + '\n';
}

export function modelsTable(profiles) {
  return table(['Model', 'Runtime', 'Configured', 'Active'], profiles.map(profile => [
    profile.name, profile.runtime,
    profile.modelPresent === false ? 'missing' : profile.model || 'external',
    profile.active ? 'yes' : '',
  ]), [20, 12, 34, 6]);
}

export function skillsTable(result) {
  const header = `Model: ${asCell(result.backend?.model) || 'unknown'}  Catalog: ${result.fullCatalogSkills} skills\n`;
  const skills = result.topK ?? [];
  if (!skills.length) return header + 'No matching local skills.\n';
  return header + table(['Skill', 'Category', 'Fit', 'Description'], skills.map(skill => [
    skill.name, skill.category, Number.isFinite(skill.fits)
      ? Math.round(skill.fits * 100) + '%' : '-',
    skill.description,
  ]), [30, 15, 5, 65]);
}
