const axios = require("axios");
const cron = require("node-cron");
const path = require("path");
const fs = require("fs");
const FormData = require("form-data");
const getLatestOtpEmail = require("./read_otp_email");

let cronExpression = "0 9,15 * * *";
let resumeCronExpression = "0 9,15 * * *";

function getRandomDelay(minSeconds, maxSeconds) {
  return (
    Math.floor(Math.random() * (maxSeconds - minSeconds + 1) + minSeconds) *
    1000
  );
}

function toggleSkill(skills, skill) {
  let skillList = skills.split(",");

  if (!skillList.includes(skill)) {
    return skills + (skills.length > 0 ? "," : "") + skill;
  }

  return skills.split(",").filter((s) => s !== skill).join(",");
}

async function login(username, password) {
  try {
    if (!process.env.NAUKRI_USERNAME || !process.env.NAUKRI_PASSWORD) {
      console.log("Please set naukri username and password");
      throw new Error("Please set naukri username and password");
    }

    let response = await axios.post(
      "https://www.naukri.com/central-login-services/v1/login",
      { username, password },
      {
        headers: {
          Appid: 103,
          Systemid: "jobseeker",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        },
      }
    );

    let nauk_at = (response.data?.cookies || []).find(
      (item) => item.name == "nauk_at"
    );

    if (!nauk_at) {
      console.log("No nauk_at cookie found. Login might have failed.");
      throw new Error("Login failed: No nauk_at cookie");
    }

    process.env.NAUKRI_TOKEN = nauk_at.value;
    console.log("Logged in to naukri");

  } catch (err) {
    console.log("Login error:", err.response?.data || err.message);

    if (err.response && err.response.status === 403 && err.response.data?.message === "MFA required") {
      console.log("🔐 OTP required. Fetching OTP from Gmail...");

      let otp = null;
      let retries = 0;

      while (!otp && retries < 100) {
        console.log(`⏳ Waiting for OTP... (${retries}/100)`);
        await new Promise(r => setTimeout(r, 5000));

        otp = await getLatestOtpEmail("info@naukri.com")
        if (otp) break;
        retries++;
      }

      if (!otp) {
        throw new Error("❌ OTP not received within timeout period.");
      }

      console.log("📨 OTP fetched:", otp);

      try {
        const response_otp = await axios.post(
          "https://www.naukri.com/central-login-services/v0/otp-login",
          {
            flowId: "mfa-login-email",
            token: otp,
            username,
          },
          {
            headers: {
              Appid: 103,
              Systemid: "jobseeker",
              "User-Agent": "Mozilla/5.0",
            },
          }
        );

        let nauk_at = (response_otp.data?.cookies || []).find(
          (item) => item.name == "nauk_at"
        );
        if (!nauk_at) {
          console.log("No nauk_at cookie found in opt callback. Login might have failed.");
          throw new Error("Login failed: No nauk_at cookie in otp callback");
        }

        process.env.NAUKRI_TOKEN = nauk_at.value;
        console.log("Logged in to naukri using otp");

      } catch (error) {
        throw new Error("OTP verification failed:", error.response?.data || error.message);
      }

    }
    else throw new Error("Login failed:", err.response?.data, err.message);
  }
}

async function userprofile(token) {
  let response = await axios.get(
    "https://www.naukri.com/cloudgateway-mynaukri/resman-aggregator-services/v2/users/self?expand_level=4",
    {
      headers: {
        Authorization: `bearer ${token}`,
        Appid: 105,
        Systemid: "Naukri",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
      },
    }
  );
  return response.data;
}

async function updateProfile(token, profileId, skills) {
  let response = await axios.post(
    "https://www.naukri.com/cloudgateway-mynaukri/resman-aggregator-services/v1/users/self/fullprofiles",
    {
      profile: {
        keySkills: skills,
      },
      profileId,
    },
    {
      headers: {
        Authorization: `bearer ${token}`,
        Appid: 105,
        Systemid: "Naukri",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        "x-http-method-override": "PUT",
      },
    }
  );
  return response.data;
}

async function updateSkills(retry = 0) {
  try {
    let token = process.env.NAUKRI_TOKEN;
    if (!token) {
      console.log("No token found, logging in...");
      await login(
        process.env.NAUKRI_USERNAME,
        process.env.NAUKRI_PASSWORD
      );
      token = process.env.NAUKRI_TOKEN;
    }

    let user_profile_response = await userprofile(token);
    let profileId = user_profile_response?.onlineProfile?.[0]?.profileId;

    process.env.NAUKRI_PROFILE_ID = profileId;
    console.log("Profile ID:", profileId);

    if (!profileId) {
      console.log("Unable to get profileId!");
      throw new Error("Unable to get profileId!");
    }

    let existingSkills = user_profile_response?.profile?.[0]?.keySkills;
    if (!existingSkills) {
      console.log("Unable to get existing skills!");
      throw new Error("Unable to get existing skills!");
    }

    let updatedSkills = toggleSkill(existingSkills, "Bootstrap");
    let skill_update_response = await updateProfile(
      token,
      profileId,
      updatedSkills
    );

    if (skill_update_response.profile) {
      console.log("Updated naukri skills");
    } else {
      console.log("Error updating naukri skills");
      throw new Error("Bad response from skill update");
    }

  } catch (error) {
    console.log("Error updating naukri skills:", error.response || error);
    if(error.response && error.response?.status === 401 && error.response?.statusText === "Unauthorized" && retry < 3) {
      console.log("Token might have expired, retrying login and resume upload...");

      await login(
        process.env.NAUKRI_USERNAME,
        process.env.NAUKRI_PASSWORD
      );
      token = process.env.NAUKRI_TOKEN;
      return await updateSkills(retry + 1);
    }

    else throw error;
  }
}

async function removeResume(token, profileId) {
  try {
    let response = await axios.post(
      `https://www.naukri.com/cloudgateway-mynaukri/resman-aggregator-services/v0/users/self/profiles/${profileId}/deleteResume`,
      {},
      {
        headers: {
          Authorization: `bearer ${token}`,
          Appid: 105,
          Systemid: 105,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
          "x-http-method-override": "DELETE",
        },
      }
    );
    return response.data;
  } catch (error) {
    throw error;
  }
}

async function uploadFile(token, profileId) {
  try {
    const form = new FormData();
    form.append("formKey", "F51f8e7e54e205");
    form.append(
      "file",
      fs.createReadStream(
        path.join(
          __dirname,
          "Virendra_Saini-lts.pdf"
        )
      )
    );
    form.append("fileName", "Virendra_Saini-lts.pdf");
    form.append("uploadCallback", "true");
    form.append("fileKey", "UxP6t4tlxcw19o");

    const response = await axios.post(
      "https://filevalidation.naukri.com/file",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `bearer ${token}`,
          Appid: 105,
          Systemid: 105,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        },
      }
    );
    return response.data;
  } catch (error) {
    throw error;
  }
}

async function addResume(token, profileId) {
  try {
    const response = await axios.post(
      `https://www.naukri.com/cloudgateway-mynaukri/resman-aggregator-services/v0/users/self/profiles/${profileId}/advResume`,
      {
        textCV: {
          fileKey: "UxP6t4tlxcw19o",
          formKey: "F51f8e7e54e205",
          textCvContent: null,
        },
      },
      {
        headers: {
          Authorization: `bearer ${token}`,
          Appid: 105,
          Systemid: 105,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
          "x-http-method-override": "PUT",
        },
      }
    );
    return response.data;
  } catch (error) {
    throw error;
  }
}

async function reuploadResume(retry = 0) {
  try {

    let token = process.env.NAUKRI_TOKEN;
    if (!token) {
      console.log("No token found, logging in...");
      await login(
        process.env.NAUKRI_USERNAME,
        process.env.NAUKRI_PASSWORD
      );
      token = process.env.NAUKRI_TOKEN;
    }

    let profileId = process.env.NAUKRI_PROFILE_ID;
    if (!profileId) {
      let user_profile_response = await userprofile(token);
      profileId = user_profile_response?.onlineProfile?.[0]?.profileId;

      process.env.NAUKRI_PROFILE_ID = profileId;
      console.log("Profile ID:", profileId);

      if (!profileId) {
        console.log("Unable to get profileId!");
        throw new Error("Unable to get profileId!");
      }

    }

    let remove_resume_response = await removeResume(token, profileId);
    await new Promise((r) => setTimeout(r, 2000));

    let upload_file_response = await uploadFile(token, profileId);
    await new Promise((r) => setTimeout(r, 1000));

    let add_resume_response = await addResume(token, profileId);

    if (add_resume_response.status) {
      console.log("Reuploaded resume on naukri");
      return {
        status: "success",
        message: "Resume reuploaded successfully",
      };
    } else {
      console.log("Error reuploading resume on naukri");
      throw new Error("Bad response from resume upload");
    }
  } catch (error) {
    console.log("Error reuploading resume on naukri:", error.response || error);
    if(error.response && error.response?.status === 401 && error.response?.statusText === "Unauthorized" && retry < 3) {
      console.log("Token might have expired, retrying login and resume upload...");

      await login(
        process.env.NAUKRI_USERNAME,
        process.env.NAUKRI_PASSWORD
      );
      token = process.env.NAUKRI_TOKEN;
      return await reuploadResume(retry + 1);
    }

    else throw error;
  }
}

async function reuploadResumeCron() {
  console.log(
    `Starting cron for reuploading resume on naukri using cron expression: ${resumeCronExpression} and a random delay upto 5 minutes`
  );
  cron.schedule(
    resumeCronExpression,
    async () => {
      const delay = getRandomDelay(0, 300);
      console.log(
        `Resume reupload triggered, delaying by ${delay / 1000}s`
      );

      setTimeout(async () => {
        try {
          await reuploadResume();
        } catch (err) {
          console.error("Error in randomized job:", err);
        }
      }, delay);
    },
    {
      timezone: "Asia/Kolkata",
    }
  );
}

async function updateSkillsCron() {
  console.log(
    `Starting cron for updating naukri skill using cron expression: ${cronExpression} and a random delay upto 5 minutes`
  );
  cron.schedule(
    cronExpression,
    async () => {
      const delay = getRandomDelay(0, 300);
      console.log(`Skill update triggered, delaying by ${delay / 1000}s`);

      setTimeout(async () => {
        try {
          await updateSkills();
        } catch (err) {
          console.error("Error in randomized job:", err);
        }
      }, delay);
    },
    {
      timezone: "Asia/Kolkata",
    }
  );
}

module.exports = {
  updateSkills,
  reuploadResume,
  updateSkillsCron,
  reuploadResumeCron,
};