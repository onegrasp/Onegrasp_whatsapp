const contactService = require("../services/contactService");
const { validateUpdateLabel } = require("../validators/contact.validator");

const uploadContacts = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { code: "validation_error", message: "No file uploaded" } });
    }
    const targetSet = req.body?.targetSet || req.query?.targetSet || null;
    const result = await contactService.uploadContacts(req.file.buffer, targetSet);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const createSingle = async (req, res, next) => {
  try {
    const result = await contactService.createSingleContact(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const deleteBulk = async (req, res, next) => {
  try {
    const { ids } = req.body;
    const result = await contactService.deleteBulkContacts(ids);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getContacts = async (req, res, next) => {
  try {
    const result = await contactService.getContacts(req.query);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const updateLabel = async (req, res, next) => {
  try {
    const validated = validateUpdateLabel(req.body);
    const result = await contactService.updateContactLabel(req.params.id, validated.label);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const deleteContact = async (req, res, next) => {
  try {
    const result = await contactService.deleteContact(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const exportContacts = async (req, res, next) => {
  try {
    const result = await contactService.exportContacts();
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const toggleImportant = async (req, res, next) => {
  try {
    const { isImportant } = req.body;
    const result = await contactService.toggleImportantContact(req.params.phone, isImportant);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getContactSets = async (req, res, next) => {
  try {
    const result = await contactService.getContactSets();
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const assignSet = async (req, res, next) => {
  try {
    const { contactIds, setName } = req.body;
    const result = await contactService.assignSet(contactIds, setName);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const removeSet = async (req, res, next) => {
  try {
    const { contactIds, setName } = req.body;
    const result = await contactService.removeSet(contactIds, setName);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  uploadContacts,
  getContacts,
  getContactSets,
  assignSet,
  removeSet,
  createSingle,
  deleteBulk,
  updateLabel,
  deleteContact,
  exportContacts,
  toggleImportant,
};
