export function GET() {
  return Response.json({enabled:false,reason:"Voice setup is pending. You can complete your note using the form."},{headers:{"Cache-Control":"no-store"}});
}
