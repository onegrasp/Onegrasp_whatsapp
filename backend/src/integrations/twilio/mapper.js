const mapInteractiveButtons = (buttons) => {
  if (!buttons || buttons.length === 0) return null;
  return buttons.map((b) => {
    if (b.type === "URL") {
      return { title: b.text, type: "url", url: b.url };
    } else if (b.type === "phone") {
      return { title: b.text, type: "phone", phone: b.phone };
    } else {
      return { title: b.text, id: b.text };
    }
  });
};

const mapTemplateToTwilioPayload = (template) => {
  const variablesMap = {};
  if (template.variables && template.variables.length > 0) {
    template.variables.forEach((v, index) => {
      variablesMap[String(index + 1)] = v;
    });
  }

  const types = {};
  const buttonsList = mapInteractiveButtons(template.buttons);

  if (buttonsList && buttonsList.length > 0) {
    const hasCta = template.buttons.some((b) => b.type === "URL" || b.type === "phone");
    if (hasCta) {
      types["twilio/call-to-action"] = {
        body: template.body,
        actions: buttonsList,
      };
    } else {
      types["twilio/quick-reply"] = {
        body: template.body,
        actions: buttonsList,
      };
    }
  } else {
    types["twilio/text"] = {
      body: template.body,
    };
  }

  return {
    friendlyName: template.name,
    language: template.language || "en",
    variables: variablesMap,
    types,
  };
};

module.exports = {
  mapTemplateToTwilioPayload,
  mapInteractiveButtons,
};
