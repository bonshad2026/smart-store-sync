/** Formats a number as Persian Toman, e.g. 450000 -> «۴۵۰٬۰۰۰ تومان» */
export function toman(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return `${Number(value).toLocaleString('fa-IR')} تومان`;
}
