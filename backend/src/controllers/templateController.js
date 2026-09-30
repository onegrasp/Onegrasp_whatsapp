const templateService = require("../services/templateService");
const { validateTemplate } = require("../validators/template.validator");

const getTemplates = async (req, res, next) => {
  try {
    const result = await templateService.getTemplates();
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getTemplateById = async (req, res, next) => {
  try {
    const template = await templateService.getTemplateById(req.params.id);
    res.json(template);
  } catch (err) {
    next(err);
  }
};

const createTemplate = async (req, res, next) => {
  try {
    const validated = validateTemplate(req.body);
    const template = await templateService.createTemplate(validated);
    res.status(201).json(template);
  } catch (err) {
    next(err);
  }
};

const updateTemplate = async (req, res, next) => {
  try {
    const validated = validateTemplate(req.body);
    const template = await templateService.updateTemplate(req.params.id, validated);
    res.json(template);
  } catch (err) {
    next(err);
  }
};

const deleteTemplate = async (req, res, next) => {
  try {
    const result = await templateService.deleteTemplate(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const submitTemplate = async (req, res, next) => {
  try {
    const result = await templateService.submitTemplate(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const syncTemplateStatus = async (req, res, next) => {
  try {
    const result = await templateService.syncTemplateStatus(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const syncTemplates = async (req, res, next) => {
  try {
    const result = await templateService.syncAllTemplates();
    res.json({ message: "Templates synced successfully", ...result });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  submitTemplate,
  syncTemplateStatus,
  syncTemplates,
};
