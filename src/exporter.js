/**
 * 导出模块
 * 支持 JSON / CSV（UTF-8 BOM，兼容 Excel）导出
 */

const fs = require("fs");
const path = require("path");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function toCSVRow(headers, obj) {
  return headers
    .map((h) => {
      let v = obj[h];
      if (Array.isArray(v)) v = v.join(" / ");
      if (v === null || v === undefined) v = "";
      v = String(v).replace(/"/g, '""');
      return `"${v}"`;
    })
    .join(",");
}

/**
 * 导出 JSON
 */
function exportJSON(data, filePath) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

/**
 * 导出 CSV（带 BOM）
 */
function exportCSV(data, filePath, headers) {
  ensureDir(path.dirname(filePath));
  const rows = [headers.join(",")];
  for (const item of data) {
    rows.push(toCSVRow(headers, item));
  }
  fs.writeFileSync(filePath, "\uFEFF" + rows.join("\r\n"), "utf-8");
  return filePath;
}

/**
 * 导出简单的 Excel（xls 格式，纯文本表格，Excel 可直接打开）
 */
function exportExcel(data, filePath, headers) {
  ensureDir(path.dirname(filePath));
  const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n<Worksheet ss:Name="收稿信息">\n<Table>\n';
  xml += "<Row>\n";
  for (const h of headers) xml += `<Cell><Data ss:Type="String">${esc(h)}</Data></Cell>\n`;
  xml += "</Row>\n";
  for (const item of data) {
    xml += "<Row>\n";
    for (const h of headers) {
      let v = item[h];
      if (Array.isArray(v)) v = v.join(" / ");
      if (v === null || v === undefined) v = "";
      xml += `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>\n`;
    }
    xml += "</Row>\n";
  }
  xml += "</Table>\n</Worksheet>\n</Workbook>";
  fs.writeFileSync(filePath, "\uFEFF" + xml, "utf-8");
  return filePath;
}

module.exports = { exportJSON, exportCSV, exportExcel, ensureDir };
