export function registerCapabilityRoutes(router, { service, wrap }) {
  router.get("/capabilities", wrap(async (request, response) => {
    response.status(200).json(await service.getCapabilities(request.query.runtimeId));
  }));
}
